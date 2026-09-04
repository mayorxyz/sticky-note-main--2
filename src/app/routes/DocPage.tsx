import { Navigate, useNavigate, useParams } from "react-router-dom";
import type {
  AnnotationsState,
  Bookmark,
  DocumentRecord,
  Settings,
  StoredData,
} from "../../domain/types";
import DocumentView from "../../components/document/DocumentView";

interface Props {
  data: StoredData;
  settings: Settings;
  resolvedTheme: "light" | "dark" | "black";
  onToggleTheme: () => void;
  onAnnotationsChange: (docId: string, ann: AnnotationsState) => void;
  onDocChange: (doc: DocumentRecord) => void;
  onBookmarkAdd: (bm: Bookmark) => void;
  onBookmarkDelete: (id: string) => void;
  onPatchSettings: (patch: Partial<Settings>) => void;
  onToast: (msg: string) => void;
}

export default function DocPage({
  data,
  settings,
  resolvedTheme,
  onToggleTheme,
  onAnnotationsChange,
  onDocChange,
  onBookmarkAdd,
  onBookmarkDelete,
  onPatchSettings,
  onToast,
}: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const doc = data.docs.find((d) => d.id === id);
  if (!doc) return <Navigate to="/" replace />;
  return (
    <DocumentView
      doc={doc}
      annotations={data.annotations[doc.id] ?? { highlights: [], notes: [] }}
      bookmarks={data.bookmarks.filter((b) => b.docId === doc.id)}
      settings={settings}
      onAnnotationsChange={onAnnotationsChange}
      onDocChange={onDocChange}
      onBookmarkAdd={onBookmarkAdd}
      onBookmarkDelete={onBookmarkDelete}
      onPatchSettings={onPatchSettings}
      onBack={() => navigate(-1)}
      onOpenSettings={() => navigate("/settings")}
      resolvedTheme={resolvedTheme}
      onToggleTheme={onToggleTheme}
      onToast={onToast}
    />
  );
}
