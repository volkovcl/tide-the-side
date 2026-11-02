'use strict';

// A safe stop: something is not the way this tool expects, so it writes nothing.
class StopError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'StopError';
    this.exitCode = exitCode;
  }
}

// Claude is open, or another write is in progress. Try again later.
class BusyError extends StopError {
  constructor(message) {
    super(message, 3);
    this.name = 'BusyError';
  }
}

module.exports = { StopError, BusyError };
