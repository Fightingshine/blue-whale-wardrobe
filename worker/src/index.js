import { handleSubmitRequest } from './submit-handler.js';

export default {
  async fetch(request, env) {
    return handleSubmitRequest(request, env);
  },
};
