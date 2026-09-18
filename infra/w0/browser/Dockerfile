# Playwright v1.63.0-noble, linux/amd64; Chromium supplied by this exact image.
FROM mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11-utils x11vnc novnc python3-websockify \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/browser
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.63.0 \
    && mkdir -p /evidence /tmp/.X11-unix \
    && chmod 1777 /tmp/.X11-unix \
    && chown pwuser:pwuser /evidence
COPY start.sh probe.mjs ./
RUN chmod 755 start.sh
USER pwuser
ENV DISPLAY=:99
CMD ["/opt/browser/start.sh"]
