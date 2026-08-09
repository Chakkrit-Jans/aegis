#!/bin/bash
# Launches the Kali desktop (XFCE) over VNC + noVNC, then runs the exec-agent in
# the foreground. All three live in the one worker container.
set -u
export USER=root
export HOME=/root

# --- desktop session ---
# Use the modern XDG path directly and remove any legacy ~/.vnc so tigervnc does
# not attempt (and fail) a migration at startup.
VNCDIR=/root/.config/tigervnc
mkdir -p "$VNCDIR"
rm -rf /root/.vnc
cat > "$VNCDIR/xstartup" <<'EOF'
#!/bin/bash
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
exec startxfce4
EOF
chmod +x "$VNCDIR/xstartup"

# --- start the VNC server on display :1 ---
# The Kali tigervnc packages ship no password tool, so we run without VncAuth.
# This is safe because the server listens on localhost only, noVNC is bound to
# 127.0.0.1 on the host, and remote access goes through an SSH tunnel — the same
# trust boundary as the console itself.
tigervncserver -kill :1 >/dev/null 2>&1 || true
rm -rf /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
tigervncserver :1 -geometry 1440x900 -depth 24 -localhost yes -SecurityTypes None

# --- noVNC (websockify) serves the web client on 6080 -> localhost:5901 ---
websockify --web=/usr/share/novnc 6080 localhost:5901 &

# --- exec-agent in the foreground keeps the container alive ---
exec python3 /opt/agent.py
