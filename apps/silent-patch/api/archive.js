import { handleArchive } from "../src/http-service.mjs";

export default async function handler(request, response) {
  await handleArchive(request, response);
}
