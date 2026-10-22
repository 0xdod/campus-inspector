import { fixtureCampus } from "./campus";
const fixture = await fixtureCampus({
  port: 8091,
  inspector: "http://localhost:8090",
});
console.log("Fixture Campus ready at " + fixture.base);
process.on("SIGTERM", () => {
  void fixture.close().then(() => process.exit(0));
});
