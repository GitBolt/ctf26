import { handleSession } from "../src/http-service.mjs";

export default async function handler(request, response) {
  await handleSession(request, response);
}
