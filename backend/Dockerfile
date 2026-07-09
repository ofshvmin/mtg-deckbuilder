FROM python:3.13-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app ./app

EXPOSE 8000
# Long-running server (keeps any in-process caches warm — not serverless)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
