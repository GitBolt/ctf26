import { handleCompletion } from "../src/http-service.mjs";

export default async function handler(request, response) {
  await handleCompletion(request, response);
}
