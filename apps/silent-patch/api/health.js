import { handleHealth } from "../src/http-service.mjs";

export default async function handler(request, response) {
  await handleHealth(request, response);
}
