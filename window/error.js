function createCustomError(name, state) {
    return class CustomError extends Error {
        constructor(message) {
            super(message);
            this.name = name;
            this.state = state;
            Object.setPrototypeOf(this, CustomError.prototype);
        }
    };
}

class StopError extends Error {
    constructor(message, errorCode) {
        super(message);
        this.name = 'StopError';
        this.errorCode = errorCode;
    }
}

module.exports = {
    StopError,
};
