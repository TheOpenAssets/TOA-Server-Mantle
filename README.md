# Mantle RWA Platform

This repository contains the backend services for the Mantle RWA Platform.

## Quick Start

### Prerequisites
- Node.js (v18+)
- yarn

### Installation
```bash
yarn install
```

### Environment setup
Create a `.env` file in `packages/backend` based on `.env.example` (to be created).

### Start development
```bash
yarn dev
```

## Architecture
This backend is part of a larger system. For a complete overview, see the architecture documentation. The backend is built with NestJS and organized into modules representing different "engines" of the platform.

## Development

### Monorepo structure
This project is a yarn monorepo. Packages are located in the `packages/` directory.

- `packages/backend`: The main NestJS application.
- `packages/types`: Shared TypeScript types and schemas.
- `packages/contracts`: Solidity smart contracts (placeholders).

### Type generation workflow
To generate types from contract ABIs (once implemented), run:
```bash
yarn generate:types
```

### Testing strategy
Each package is responsible for its own tests. To run tests for a specific package, navigate to its directory and run its test command.