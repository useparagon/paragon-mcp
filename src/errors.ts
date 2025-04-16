import { UserNotConnectedResponse } from "./type";

export class JsonResponseError extends Error {
  public jsonResponse: any;

  constructor(message: string, jsonResponse: any) {
    super(message);
    this.jsonResponse = jsonResponse;
    this.name = "JsonResponseError";
  }
}

export class UserNotConnectedError extends JsonResponseError {
  public jsonResponse: UserNotConnectedResponse;

  constructor(message: string, jsonResponse: UserNotConnectedResponse) {
    super(message, jsonResponse);
    this.jsonResponse = jsonResponse;
    this.name = "UserNotConnectedError";
  }
}
