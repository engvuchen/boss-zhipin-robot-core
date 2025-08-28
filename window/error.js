class StopError extends Error {
    constructor(message, errorCode) {
        super(message);
        this.name = 'StopError';
        this.errorCode = errorCode;
    }
}

export { StopError };
