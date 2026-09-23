FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS ui
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.21@sha256:ff07b86af50d4d9391d9daf4ff89ce427bc544f9aae87057e69a1cc0aa369946 AS uv
FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS runtime
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PYTHON_DOWNLOADS=never PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-cache && useradd --uid 10001 --create-home app && mkdir /app/out && chown app:app /app /app/out
COPY case/starter/ ./case/starter/
COPY case/data/ ./case/data/
COPY config.toml run.py healthcheck.py assistant.py ./
COPY --from=ui /build/web/dist ./web/dist
RUN chmod -R a+rX /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=10s --start-period=300s --retries=3 CMD ["python", "healthcheck.py"]
CMD ["python", "run.py", "--serve", "--host", "0.0.0.0", "--port", "8080"]
