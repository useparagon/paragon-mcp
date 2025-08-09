export class JsonResponseError extends Error {
  public jsonResponse: any;

  constructor(message: string, jsonResponse: any) {
    super(message);
    this.jsonResponse = jsonResponse;
    this.name = "JsonResponseError";
  }
}

export class UserNotConnectedError extends JsonResponseError {
  constructor(message: string) {
    super(message, null);
    this.name = "UserNotConnectedError";
  }
}
