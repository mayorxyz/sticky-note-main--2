import { useNavigate } from "react-router-dom";
import type { Settings } from "../../domain/types";
import SettingsPage from "../../components/settings/Settings";

interface Props {
  settings: Settings;
  bytes: number;
  onPatch: (patch: Partial<Settings>) => void;
  onExportAll: () => void;
  onClearAll: () => void;
}

export default function SettingsRoute({
  settings,
  bytes,
  onPatch,
  onExportAll,
  onClearAll,
}: Props) {
  const navigate = useNavigate();
  return (
    <SettingsPage
      settings={settings}
      storageBytes={bytes}
      onPatch={onPatch}
      onBack={() => navigate(-1)}
      onExportAll={onExportAll}
      onClearAll={onClearAll}
    />
  );
}
