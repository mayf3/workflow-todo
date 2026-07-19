/**
 * Workflow SDK Adapter
 *
 * Adapts the formal Workflow SDK (@workflow-foundation/sdk) types into
 * Todo View Models for display in CLI / formatters.
 *
 * Responsibilities:
 *   - Create SDK WorkflowClient via factory (accepts injected TokenProvider)
 *   - Convert SDK WorklistPage → TodoWorklistPageView via explicit field mapping
 *   - Convert SDK create response → TodoCreateResultView
 *   - Convert SDK transition response → TodoTransitionResultView
 *   - Map Workflow SDK errors to product-friendly messages
 *
 * Not responsible for:
 *   - Implementing any auth/token protocol
 *   - Implementing pagination / cursor logic beyond what the SDK provides
 *   - Implementing Workflow state machines, node resolution, or permission checks
 *   - Falling back to legacy client on failure
 */

import { WorkflowClient as SDKWorkflowClient } from '@workflow-foundation/sdk';
import type {
  TokenProvider,
  WorklistPage,
  CreateWorkflowInstanceResponse,
  ExecuteWorkflowTransitionResponse,
  CreateWorkflowInstanceRequest,
  ExecuteWorkflowTransitionRequest,
  WorkflowError as SDKWorkflowErrorType,
} from '@workflow-foundation/sdk';
import type {
  TodoWorklistPageView,
  TodoCreateResultView,
  TodoTransitionResultView,
} from './todo-view-models.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TodoWorkflowClientConfig {
  baseUrl: string;
  tokenProvider: TokenProvider;
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTodoWorkflowClient(config: TodoWorkflowClientConfig): SDKWorkflowClient {
  return new SDKWorkflowClient({
    baseUrl: config.baseUrl,
    tokenProvider: config.tokenProvider,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

// ---------------------------------------------------------------------------
// Worklist adapter
// ---------------------------------------------------------------------------

/**
 * Convert a single SDK WorklistPage to a TodoWorklistPageView.
 *
 * The SDK response uses snake_case field names (from the wire protocol).
 * This adapter maps each field explicitly — no dynamic / unknown access.
 */
export function toWorklistPageView(sdkPage: WorklistPage): TodoWorklistPageView {
  const items = sdkPage.items.map((item) => {
    const instance = item.detail.instance;
    const node = instance.current_node;
    const ctxPayload = extractPayload(item.detail.current_context?.payload);

    return {
      workflowInstanceId: instance.workflow_instance_id,
      definitionVersionId: instance.definition_version_id,
      definitionKey: instance.definition_version_id.slice(0, 8) + '…',
      createdAt: instance.created_at,
      currentNodeKey: node.node_key,
      currentNodeDisplayName: node.display_name,
      title: typeof ctxPayload?.title === 'string' && ctxPayload.title.length > 0 ? ctxPayload.title : '(no title)',
      priority: typeof ctxPayload?.priority === 'string' ? ctxPayload.priority : null,
    };
  });

  return {
    items,
    nextCursor: sdkPage.next_cursor
      ? { createdAt: sdkPage.next_cursor.created_at, id: sdkPage.next_cursor.id }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Create result adapter
// ---------------------------------------------------------------------------

export function toCreateResultView(result: CreateWorkflowInstanceResponse): TodoCreateResultView {
  return {
    workflowInstanceId: result.workflowInstanceId,
    workflowStateVersion: result.workflowStateVersion,
    eventSequence: result.eventSequence,
  };
}

// ---------------------------------------------------------------------------
// Transition result adapter
// ---------------------------------------------------------------------------

export function toTransitionResultView(
  result: ExecuteWorkflowTransitionResponse,
): TodoTransitionResultView {
  return {
    workflowInstanceId: result.workflowInstanceId,
    workflowStateVersion: result.workflowStateVersion,
    eventSequence: result.eventSequence,
  };
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

export interface ProductError {
  message: string;
  userAction: string;
}

/**
 * Map a Workflow SDK error to a product-friendly message.
 *
 * The SDK error provides { kind, status, code, message }.
 * This function translates that into an end-user oriented message +
 * suggested action, without exposing internal wire protocol details.
 */
export function toProductError(error: unknown): ProductError {
  const err = error as Partial<SDKWorkflowErrorType>;

  switch (err.kind) {
    case 'configuration':
      return {
        message: 'Service configuration error',
        userAction: 'Please check your workflow-todo configuration and try again.',
      };

    case 'transport':
      return {
        message: 'Unable to reach the workflow service',
        userAction: 'Please check network connectivity and service availability.',
      };

    case 'api':
      switch (err.status) {
        case 401:
          return {
            message: 'Authentication failed',
            userAction: 'Please check your credentials and try again.',
          };
        case 403:
          return {
            message: 'You do not have permission to perform this action',
            userAction: 'Contact your domain administrator if you need access.',
          };
        case 409:
          if (err.code === 'workflow_state_version_conflict') {
            return {
              message: 'The workflow state has changed since you last loaded it',
              userAction: 'Please reload the workflow and try again.',
            };
          }
          return {
            message: 'A conflict occurred processing your request',
            userAction: 'Please try again.',
          };
        case 422:
          return {
            message: 'Invalid request',
            userAction: 'Please check your input and try again.',
          };
        case 429:
          return {
            message: 'Too many requests',
            userAction: 'Please wait a moment and try again.',
          };
        default:
          return {
            message: err.message || 'An unexpected error occurred',
            userAction: 'Please try again or contact support.',
          };
      }

    case 'protocol':
      return {
        message: 'Received an unexpected response from the workflow service',
        userAction: 'Please try again. If the problem persists, contact support.',
      };

    case 'input':
      return {
        message: err.message || 'Invalid input',
        userAction: 'Please check your input and try again.',
      };

    default:
      return {
        message: 'An unexpected error occurred',
        userAction: 'Please try again or contact support.',
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract the context payload as a record.
 */
function extractPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}
