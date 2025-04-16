import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface LinkConnectionProps {
  userId?: string;
  personaId?: string;
  projectId?: string;
  integrationId?: string;
  integrationName?: string;
  loginToken?: string;
}

export type UserNotConnectedResponse = {
  message: string;
  code: string;
  status: number;
  meta: {
    personaId: string;
    projectId: string;
    integrationId: string;
    endUserId: string;
  };
};

export interface ExtendedTool extends Tool {
  integrationName: string;
  requiredFields: string[];
}

export type TransportPayload = {
  transport: SSEServerTransport;
  currentJwt: string;
};
