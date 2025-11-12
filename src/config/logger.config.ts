import { LogLevel, setGlobalLogLevel } from '@kasstamp/utils';
// Uncomment the following line if you need per-namespace configuration:
import { setNamespaceLogLevel } from '@kasstamp/utils';

/**
 * Logger configuration based on environment
 */
export function initializeLoggers(): void {
  const isProduction = import.meta.env.PROD;

  if (isProduction) {
    // ============================================================================
    // PRODUCTION CONFIGURATION
    // ============================================================================
    // Default: Show all logs
    setGlobalLogLevel(LogLevel.DEBUG);

    setNamespaceLogLevel('gitchain:web:app', LogLevel.DEBUG);

    setNamespaceLogLevel('kasstamp:web:wallet', LogLevel.DEBUG);

    // Enable Kaspa SDK logs
    setNamespaceLogLevel('kasstamp:sdk', LogLevel.DEBUG);

    // You can selectively reduce noise from specific packages:
    // Example: Reduce RPC connection logs using WARN
    setNamespaceLogLevel('kasstamp:rpc:connection', LogLevel.DEBUG);

    // You can selectively enable DEBUG/INFO logs for specific packages if needed:
    // Example: Debug wallet issues in production
    setNamespaceLogLevel('kasstamp:wallet:*', LogLevel.DEBUG);

    // Enable WASM SDK logs
    setNamespaceLogLevel('kasstamp:sdk:wasm', LogLevel.DEBUG);

    // Example: Show info logs for stamping operations
    setNamespaceLogLevel('kasstamp:stamping:*', LogLevel.DEBUG);
  } else {
    // ============================================================================
    // DEVELOPMENT CONFIGURATION
    // ============================================================================
    // Default: Show all logs
    setGlobalLogLevel(LogLevel.DEBUG);

    setNamespaceLogLevel('gitchain:web:app', LogLevel.DEBUG);

    setNamespaceLogLevel('kasstamp:web:wallet', LogLevel.DEBUG);

    // Enable Kaspa SDK logs
    setNamespaceLogLevel('kasstamp:sdk', LogLevel.DEBUG);

    // You can selectively reduce noise from specific packages:
    // Example: Reduce RPC connection logs using WARN
    setNamespaceLogLevel('kasstamp:rpc:connection', LogLevel.DEBUG);

    // You can selectively enable DEBUG/INFO logs for specific packages if needed:
    // Example: Debug wallet issues in production
    setNamespaceLogLevel('kasstamp:wallet:*', LogLevel.DEBUG);

    // Enable WASM SDK logs
    setNamespaceLogLevel('kasstamp:sdk:wasm', LogLevel.DEBUG);

    // Example: Show info logs for stamping operations
    setNamespaceLogLevel('kasstamp:stamping:*', LogLevel.DEBUG);
  }
}
