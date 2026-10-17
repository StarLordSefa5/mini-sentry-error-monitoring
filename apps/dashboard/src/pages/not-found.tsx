import { CompassIcon } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/states";

export function NotFoundPage() {
  return (
    <EmptyState icon={<CompassIcon />} title="Page not found">
      <Link to="/projects" className="underline underline-offset-4">
        Back to projects
      </Link>
    </EmptyState>
  );
}
