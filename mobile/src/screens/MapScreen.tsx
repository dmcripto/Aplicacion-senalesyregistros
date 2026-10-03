import { ScrollView } from "react-native";
import LiquidationMapView from "../LiquidationMapView";

export default function MapScreen() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <LiquidationMapView />
    </ScrollView>
  );
}
