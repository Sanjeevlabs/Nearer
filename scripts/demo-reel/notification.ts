// Run in a dedicated process with the Meta key supplied by the environment.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { museImage } from "../../lib/muse-image";
import { eventWords } from "../../lib/push/copy";

async function main() {
  if (!process.env.META_API_KEY) throw new Error("META_API_KEY is required in the environment for the notification shot");
  const dir = resolve("out/demo-reel");
  await mkdir(dir, { recursive: true });
  const image = await museImage({
    familyId: "demo-family",
    purpose: "Made the synthetic notification shot for the demo",
    prompt: "Portrait orientation, cinematic still of a fictional adult Indian son in his early thirties at home looking warmly at his phone, over the shoulder with his face in profile, warm light, phone visible near the middle and pointed enough towards the camera to see the screen. Unbranded phone, no logos or lettering. Entire face inside the frame. This depicts no real person.",
    images: [],
    attempts: 1,
    size: "1024x1536",
  });
  if (image.status !== "ok") throw new Error(`Muse Image did not return a notification still (${image.status})`);
  await writeFile(resolve(dir, "notification-source.jpg"), Buffer.from(image.image.split(",", 2)[1], "base64"));
  await writeFile(resolve(dir, "notification-copy.txt"), eventWords.door("Maa", true));
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Unable to render the notification still");
  process.exitCode = 1;
});
