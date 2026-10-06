import { Game } from "@/components/Game";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { camera } = await searchParams;
  return <Game nativeCamera={camera === "native"} />;
}
