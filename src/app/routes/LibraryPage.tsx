import { useNavigate } from "react-router-dom";
import type {
  AnnotationsState,
  DocumentRecord,
  Settings,
  StoredData,
} from "../../domain/types";
import Library, { type BackupPayload } from "../../components/library/Library";

interface Props {
  data: StoredData;
  resolvedTheme: "light" | "dark" | "black";
  onToggleTheme: () => void;
  onDelete: (id: string) => void;
  onIngest: (doc: DocumentRecord, ann: AnnotationsState) => void;
  onImportBackup: (p: BackupPayload) => void;
  onSample: () => string;
  onToast: (msg: string) => void;
  onRename: (id: string, title: string) => void;
}

export default function LibraryPage({
  data,
  resolvedTheme,
  onToggleTheme,
  onDelete,
  onIngest,
  onImportBackup,
  onSample,
  onToast,
  onRename,
}: Props) {
  const navigate = useNavigate();
  return (
    <Library
      docs={data.docs}
      annotations={data.annotations}
      resolvedTheme={resolvedTheme}
      onToggleTheme={onToggleTheme}
      onOpenSettings={() => navigate("/settings")}
      onOpen={(id) => navigate(`/doc/${id}`)}
      onDelete={onDelete}
      onRename={onRename}
      onIngest={(doc, ann) => {
        onIngest(doc, ann);
        navigate(`/doc/${doc.id}`);
      }}
      onImportBackup={onImportBackup}
      onSample={() => navigate(`/doc/${onSample()}`)}
      onToast={onToast}
    />
  );
}
