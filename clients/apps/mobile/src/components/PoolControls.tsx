import { View, Text, TouchableOpacity } from "react-native";
import type { PoolScope } from "@mtg/shared";
import SetPicker from "./SetPicker";

// Which cards a build may draw on, mirroring the web control: first "skip what's
// already sleeved up in another deck", then "and only from these sets". Both
// default to off, so an untouched build uses the whole collection.

export default function PoolControls({
  scope,
  onScopeChange,
  sets,
  onSetsChange,
  disabled,
}: {
  scope: PoolScope;
  onScopeChange: (next: PoolScope) => void;
  sets: string[];
  onSetsChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        Card pool
      </Text>

      <View className="flex-row rounded-lg border border-slate-700 p-0.5">
        <TouchableOpacity
          onPress={() => onScopeChange("owned")}
          disabled={disabled}
          className={"flex-1 rounded-md py-2 " + (scope === "owned" ? "bg-slate-800" : "")}
          activeOpacity={0.7}
        >
          <Text className={"text-center text-sm " + (scope === "owned" ? "text-white" : "text-slate-400")}>
            All owned
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onScopeChange("available")}
          disabled={disabled}
          className={"flex-1 rounded-md py-2 " + (scope === "available" ? "bg-slate-800" : "")}
          activeOpacity={0.7}
        >
          <Text className={"text-center text-sm " + (scope === "available" ? "text-white" : "text-slate-400")}>
            Available only
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mt-2">
        <SetPicker
          sets={sets}
          onChange={onSetsChange}
          countKey={scope === "available" ? "available" : "owned"}
          disabled={disabled}
        />
      </View>

      <Text className="mt-2 text-xs text-slate-500">
        {scope === "available"
          ? "Skipping cards already in a deck marked “in use”."
          : "Drawing on your whole collection."}
        {sets.length > 0 && " Basic lands are always available regardless of set."}
      </Text>
    </View>
  );
}
