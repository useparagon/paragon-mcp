# Agent Guidelines for Paragon MCP Server

## Build/Lint/Test Commands

### Build Commands
- `npm run build` - Build production bundle using esbuild
- `npm run dev` - Start development server with hot reload using tsx
- `npm run start` - Start production server using tsx
- `npm run start:prod` - Start production server using built dist

### Testing Commands
- No testing framework configured - consider adding Jest or Vitest
- Run single test: `npm test -- <test-file>` (once testing is set up)

### Linting Commands
- No linter configured - consider adding ESLint with TypeScript support
- Run lint: `npm run lint` (once ESLint is set up)

## Code Style Guidelines

### TypeScript Configuration
- Use strict TypeScript mode with `strict: true`
- Target ES2022 with ESNext modules
- Use explicit types for function parameters and return values
- Use interface/type definitions for complex objects

### Import/Export Style
- Use named imports: `import { functionName } from './module'`
- Group imports by: external libraries, internal modules, types
- Use relative imports for internal modules: `import { utils } from '../utils'`

### Naming Conventions
- **Variables/Functions**: camelCase (`userId`, `getActions`, `handleResponse`)
- **Classes/Types/Interfaces**: PascalCase (`ExtendedTool`, `Integration`)
- **Constants**: UPPER_SNAKE_CASE (`MINUTES`, `DEBUG`)
- **Files**: kebab-case (`access-tokens.ts`, `custom-tools.ts`)

### Error Handling
- Use custom error classes extending base Error
- Throw descriptive error messages with context
- Use try/catch blocks for async operations
- Handle HTTP response errors with `handleResponseErrors` utility
- Log errors appropriately (debug in development, silent in production)

### Async/Await Patterns
- Prefer async/await over Promises
- Use try/catch for error handling in async functions
- Return early from functions when possible
- Use `Promise.all()` for concurrent operations

### Code Structure
- Use arrow functions for callbacks and short functions
- Use object destructuring for parameters and return values
- Use template literals for string interpolation
- Use early returns to reduce nesting
- Keep functions focused on single responsibility
- Use descriptive variable names that explain purpose

### Validation
- Use Zod schemas for runtime validation of configuration and inputs
- Validate environment variables at startup
- Provide clear error messages for validation failures

### Logging
- Use the custom Logger utility for debug messages
- Only log in development mode for debug information
- Use console.error for actual errors
- Include relevant context in log messages

### Security
- Never log sensitive information (tokens, keys, passwords)
- Validate JWT tokens properly
- Use HTTPS in production
- Follow principle of least privilege for API access

### Dependencies
- Check package.json before adding new dependencies
- Prefer established libraries used in the codebase
- Use TypeScript definitions when available (@types/*)

### File Organization
- Keep related functionality in separate files
- Use index.ts for clean imports from directories
- Group utilities in dedicated files (utils.ts, errors.ts)
- Separate concerns: server setup, business logic, types