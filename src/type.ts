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
  integrationId?: string;
  requiredFields: string[];
  isOpenApiTool: boolean;
}

export type TransportPayload = {
  transport: SSEServerTransport;
  currentJwt: string;
  cachedTools?: ExtendedTool[];
};

interface BaseIntegration {
  id: string;
  dateCreated: string;
  dateUpdated: string;
  projectId: string;
  customIntegrationId: string | null;
  resourceId: string | null;
  isActive: boolean;
  configs: IntegrationConfig[];
  workflows: Workflow[];
  hasCredential: boolean;
  connectedUserLimitOnDevCred: number;
  connectedUserLimitReached: boolean;
  name: string;
  brandColor: string;
  needPreOauthInputs: boolean;
  providerType: string;
  authenticationType: string;
  sdkIntegrationConfig: SdkIntegrationConfig;
}

export type Integration = 
  | (BaseIntegration & { type: "custom"; customIntegration: CustomIntegration })
  | (BaseIntegration & { type: string; customIntegration: CustomIntegration | null });

export interface IntegrationConfig {
  id: string;
  dateCreated: string;
  dateUpdated: string;
  integrationId: string;
  values: {
    overview?: string;
    sharedMeta?: {
      inputs?: Array<{
        id: string;
        type: string;
        title: string;
        required: boolean;
        sourceType: string;
        useDynamicMapper?: boolean;
        dynamicObjectName?: string;
        savedFieldMappings?: Array<{
          label: string;
        }>;
        dynamicObjectOptions?: Array<{
          label: string;
          value: string;
        }>;
      }>;
    };
    accentColor: string;
    description: string;
    workflowMeta: Record<string, {
      id: string;
      inputs: Array<{
        id: string;
        type: string;
        title: string;
        required: boolean;
        sourceType: string;
        savedFieldMappings?: any[];
      }>;
      infoText: string;
      defaultEnabled?: boolean;
    }>;
  };
}

export interface Workflow {
  id: string;
  dateCreated: string;
  dateUpdated: string;
  description: string;
  projectId: string;
  teamId: string;
  isOnboardingWorkflow: boolean;
  integrationId: string;
  workflowVersion: number;
  steps: any[];
}

export interface SdkIntegrationConfig {
  postOauthInputs: any[];
  authConfigInputs: any[];
  oauthInputs: any[];
  accountTypes: any[];
  dataSources: {
    [key: string]: {
      type: string;
      title: string;
      hideFromConnectFieldTypes?: boolean;
      cacheKey?: string;
      refreshDependencies?: Array<string | null>;
      subtitle?: string;
      id?: string;
      values?: Array<{
        label: string;
        value: string;
      }>;
      mainInputSource?: {
        type: string;
        cacheKey: string;
        title: string;
        subtitle: string;
        hideFromConnectFieldTypes: boolean;
        refreshDependencies: any[];
      };
      dependentInputSource?: {
        type: string;
        cacheKey: string;
        title: string;
        hideFromConnectFieldTypes: boolean;
        subtitle: string;
        refreshDependencies: string[];
      };
      instructionalText?: any;
      recordSource?: {
        type: string;
        title: string;
        cacheKey: string;
        hideFromConnectFieldTypes: boolean;
        subtitle: string;
        refreshDependencies: Array<null | string>;
      };
      fieldSource?: {
        type: string;
        hideFromConnectFieldTypes: boolean;
        title: string;
        cacheKey: string;
        refreshDependencies: string[];
      };
    };
  };
  authSchemeOptions: Record<string, any>;
}

export interface CustomIntegration {
  id: string;
  dateCreated: string;
  dateUpdated: string;
  projectId: string;
  name: string;
  icon: string;
  authenticationType: string;
  inputFields: any[];
  isPublished: boolean;
  slug: string;
}

export type ProxyApiRequestToolArgs = {
  integration: string;
  url: string;
  httpMethod: string;
  queryParams?: Record<string, any>;
  headers?: Record<string, string>;
  body?: Record<string, any>;
};