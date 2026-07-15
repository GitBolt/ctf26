import { handleTarget } from "../src/http-service.mjs";

export default async function handler(request, response) {
  await handleTarget(request, response);
}
