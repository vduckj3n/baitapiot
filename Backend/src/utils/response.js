export const sendSuccess = (res, data, status = 200, message) => {
  const body = { success: true };
  if (message) {
    body.message = message;
  }
  if (data !== undefined) {
    body.data = data;
  }
  return res.status(status).json(body);
};

export const createHttpError = (status, message) =>
  Object.assign(new Error(message), { status });
