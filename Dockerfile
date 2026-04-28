# Use the official Bun image
FROM oven/bun:latest

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package.json bun.lockb ./
# Use --frozen-lockfile for deterministic builds and --production to skip dev dependencies
RUN bun install --frozen-lockfile --production

# Copy the rest of the application code
COPY . .

# Create the database directory so SQLite doesn't throw an error
RUN mkdir -p db

# Command to run the bot
CMD ["bun", "run", "src/index.ts"]