import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex items-center h-full flex-1 justify-center bg-muted/40">
      <div className="text-center px-6">
        <h1 className="text-6xl font-bold m-0 mb-1 tracking-tight">404</h1>
        <h2 className="text-2xl font-semibold m-0">Page Not Found</h2>
        <p className="text-muted-foreground m-0 mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Button asChild>
          <Link href="/">Go Home</Link>
        </Button>
      </div>
    </div>
  );
}
