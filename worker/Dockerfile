FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# Core pentest toolchain. nuclei is not always in the base repo — install best
# effort; if absent the agent reports it cleanly at call time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      ca-certificates \
      curl \
      procps \
      git \
      sudo \
      nmap \
      nikto \
      whatweb \
      wpscan \
      ffuf \
      gobuster \
      hydra \
      exploitdb \
      dnsutils \
      dirb \
    && (apt-get install -y --no-install-recommends nuclei || true) \
    && rm -rf /var/lib/apt/lists/*

# The `wordlists` meta-package (installed best-effort above, and bundled with other
# packages that may fail) normally creates /usr/share/wordlists/dirb -> /usr/share/dirb/wordlists.
# Guarantee that standard Kali path exists so dir_enum's default wordlist always resolves.
RUN mkdir -p /usr/share/wordlists \
    && { [ -e /usr/share/wordlists/dirb ] || ln -s /usr/share/dirb/wordlists /usr/share/wordlists/dirb; }

# Graphical desktop reachable over VNC + noVNC (Burp, Firefox, GUI tooling).
RUN apt-get update && apt-get install -y --no-install-recommends \
      xfce4 \
      xterm \
      dbus-x11 \
      tigervnc-standalone-server \
      tigervnc-common \
      novnc \
      websockify \
    && rm -rf /var/lib/apt/lists/*

# GUI security apps (best effort — keeps the build resilient if a package moves).
RUN apt-get update \
    && (apt-get install -y --no-install-recommends firefox-esr burpsuite || true) \
    && rm -rf /var/lib/apt/lists/*

# Small curated wordlists so credential testing has sane defaults.
RUN mkdir -p /usr/share/aegis
COPY wordlists/ /usr/share/aegis/
COPY agent.py /opt/agent.py
COPY start.sh /opt/start.sh
RUN chmod +x /opt/start.sh

ENV PORT=7000
# 7000 = exec agent (internal), 6080 = noVNC web desktop.
EXPOSE 7000 6080
CMD ["/opt/start.sh"]
