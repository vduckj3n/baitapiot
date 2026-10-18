import { actionRepository } from '../repositories/actionRepository.js';

export const actionService = {
  async list(query) {
    return actionRepository.list(query);
  },
};
