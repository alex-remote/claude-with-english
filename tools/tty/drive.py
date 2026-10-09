"""Drive Claude Code in a pseudo-terminal: type, press keys, click, read the screen.

Used by the terminal probes and by each milestone's terminal acceptance run
(docs/dev-plan.md, 测试和验收). Needs the pyte package:

    python3 -m venv <dir> && <dir>/bin/pip install pyte

Example:

    from drive import Term
    t = Term(['claude', '--plugin-dir', PLUGIN], cwd=PLAYGROUND)
    t.wait_for('for shortcuts')
    t.type('帮我看看这个报错')
    t.pause(1.5)
    print(t.text())
    t.key('C-a')
    t.close()
"""

import fcntl
import os
import pty
import re
import select
import signal
import struct
import termios
import time

import pyte

KEYS = {
    'Enter': b'\r',
    'Esc': b'\x1b',
    'Tab': b'\t',
    'S-Tab': b'\x1b[Z',
    'Backspace': b'\x7f',
    'Up': b'\x1b[A',
    'Down': b'\x1b[B',
    'Right': b'\x1b[C',
    'Left': b'\x1b[D',
    'C-a': b'\x01',
    'C-c': b'\x03',
    'C-e': b'\x05',
    'C-o': b'\x0f',
    'C-u': b'\x15',
    'C-x': b'\x18',
    'C-_': b'\x1f',
}


class Term:
    """One Claude Code process on a pty, its screen kept by pyte."""

    def __init__(self, argv, cwd=None, cols=120, rows=40, env=None, log=None):
        self.cols, self.rows = cols, rows
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.log = open(log, 'ab') if log else None
        pid, fd = pty.fork()
        if pid == 0:
            if cwd:
                os.chdir(cwd)
            # A terminal of the person's own: none of the markers a host session
            # (the desktop app, another Claude Code) passes to its children
            child_env = {
                k: v
                for k, v in os.environ.items()
                if not k.startswith('CLAUDE') and k != 'ANTHROPIC_BASE_URL'
            }
            child_env.update(TERM='xterm-256color', COLORTERM='truecolor')
            child_env.update(env or {})
            os.execvpe(argv[0], argv, child_env)
        self.pid, self.fd = pid, fd
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def pump(self, seconds=0.2):
        """Reads what the process wrote for `seconds`, answering the queries a TUI sends."""
        end = time.time() + seconds
        while True:
            left = end - time.time()
            if left <= 0:
                return
            ready, _, _ = select.select([self.fd], [], [], left)
            if not ready:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            if not data:
                return
            if self.log:
                self.log.write(data)
            self._answer_queries(data)
            self.stream.feed(data)

    def _answer_queries(self, data):
        # Device attributes and cursor position, so the TUI does not wait on them
        if b'\x1b[c' in data or b'\x1b[0c' in data:
            self.send(b'\x1b[?62;22c')
        if b'\x1b[6n' in data:
            y, x = self.screen.cursor.y + 1, self.screen.cursor.x + 1
            self.send(b'\x1b[%d;%dR' % (y, x))

    def send(self, data):
        os.write(self.fd, data)

    def type(self, text, per_char=0.0):
        """Types text; per_char > 0 sends it a character at a time, like a person."""
        if per_char <= 0:
            self.send(text.encode())
            self.pump(0.1)
            return
        for ch in text:
            self.send(ch.encode())
            self.pump(per_char)

    def paste(self, text):
        """Sends text as one bracketed paste."""
        self.send(b'\x1b[200~' + text.encode() + b'\x1b[201~')
        self.pump(0.2)

    def key(self, name, times=1, gap=0.05):
        for _ in range(times):
            self.send(KEYS[name])
            self.pump(gap)

    # Mouse, as SGR reports (the fullscreen layout turns mouse reporting on).
    # x and y are 0-based screen cells.
    def click(self, x, y, button=0):
        self.send(b'\x1b[<%d;%d;%dM' % (button, x + 1, y + 1))
        self.send(b'\x1b[<%d;%d;%dm' % (button, x + 1, y + 1))
        self.pump(0.2)

    def double_click(self, x, y):
        self.click(x, y)
        self.click(x, y)

    def hover(self, x, y):
        self.send(b'\x1b[<35;%d;%dM' % (x + 1, y + 1))
        self.pump(0.2)

    def drag(self, x0, y0, x1, y1):
        self.send(b'\x1b[<0;%d;%dM' % (x0 + 1, y0 + 1))
        self.pump(0.05)
        self.send(b'\x1b[<32;%d;%dM' % (x1 + 1, y1 + 1))
        self.pump(0.05)
        self.send(b'\x1b[<0;%d;%dm' % (x1 + 1, y1 + 1))
        self.pump(0.2)

    def resize(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.screen.resize(rows, cols)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.kill(self.pid, signal.SIGWINCH)
        self.pump(0.5)

    def pause(self, seconds):
        self.pump(seconds)

    def text(self):
        return '\n'.join(line.rstrip() for line in self.screen.display)

    def find(self, pattern):
        """(x, y) of the first match of a regex on screen, or None."""
        for y, line in enumerate(self.screen.display):
            m = re.search(pattern, line)
            if m:
                return m.start(), y
        return None

    def wait_for(self, pattern, timeout=30.0):
        """Pumps until a regex shows on screen; returns its (x, y) or raises."""
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.2)
            at = self.find(pattern)
            if at:
                return at
        raise TimeoutError(f'{pattern!r} not on screen after {timeout}s:\n{self.text()}')

    def close(self):
        """Ends the process: SIGTERM, then SIGKILL if it is still there after 3 s."""
        for sig, grace in ((signal.SIGTERM, 3.0), (signal.SIGKILL, 2.0)):
            try:
                os.kill(self.pid, sig)
            except ProcessLookupError:
                break
            end = time.time() + grace
            while time.time() < end:
                self.pump(0.1)
                try:
                    done, _ = os.waitpid(self.pid, os.WNOHANG)
                except ChildProcessError:
                    done = self.pid
                if done:
                    break
            else:
                continue
            break
        try:
            os.close(self.fd)
        except OSError:
            pass
        if self.log:
            self.log.close()
