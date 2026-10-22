export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runtime } = await import("./server/runtime");
    await runtime();
  }
}
