# --- Stage 1: Build ---
# Use a Node.js base image to build our dependencies
FROM node:20-alpine AS builder

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies using npm ci for faster, more reliable builds
RUN npm ci --only=production

# --- Stage 2: Run ---
# Use a lightweight Node.js image for the final container
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy dependencies from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# The command to start the app
CMD [ "node", "index.js" ]