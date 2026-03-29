FROM node:20-alpine AS frontend-builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=1.8.4 \
    POETRY_VIRTUALENVS_CREATE=false \
    HOST=0.0.0.0 \
    PORT=8000 \
    DB_PATH=/data/progress_tracker.db

RUN pip install --no-cache-dir "poetry==${POETRY_VERSION}"

COPY pyproject.toml ./
RUN poetry install --only main --no-interaction --no-ansi

COPY backend ./backend
COPY --from=frontend-builder /app/dist ./dist

RUN mkdir -p /data

EXPOSE 8000
VOLUME ["/data"]

CMD ["sh", "-c", "poetry run uvicorn backend.main:app --host ${HOST} --port ${PORT}"]
