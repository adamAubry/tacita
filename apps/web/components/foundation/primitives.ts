/**
 * **Le seul fichier du shard qui importe Astryx.** Tout le reste passe par ici.
 *
 * Ce n'est pas une préférence de style, c'est une contrainte de construction (M-A,
 * spike du 05/08/2026) : importer depuis le barrel `@astryxdesign/core` casse la
 * compilation de Next.js — *« unsupported to use "export \*" in a client boundary »*.
 * Les sous-chemins fonctionnent, et les centraliser ici fait que l'erreur ne peut être
 * commise qu'à un endroit. Un test structurel garde la règle.
 *
 * DESIGN.md interdit de recoder une primitive existante d'Astryx : ce fichier réexporte,
 * il n'enveloppe pas. Les composants **composés** du wireframe (Navbar, Placeholder…)
 * sont des fichiers à part, et eux consomment ce module.
 */
export { Avatar } from "@astryxdesign/core/Avatar";
export { Badge } from "@astryxdesign/core/Badge";
export { Banner } from "@astryxdesign/core/Banner";
export { Button } from "@astryxdesign/core/Button";
export { Card } from "@astryxdesign/core/Card";
// `ChatComposer` n'est pas réexporté : son shell est une colonne `[champ] [actions]`,
// la forme d'un composer d'assistant, et la barre d'écriture d'une messagerie est une
// rangée (escalade E-16). Seul le champ, lui, est repris tel quel.
export { ChatComposerInput } from "@astryxdesign/core/Chat";
export { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
export { ClickableCard } from "@astryxdesign/core/ClickableCard";
export { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
export { Divider } from "@astryxdesign/core/Divider";
export { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
export { EmptyState } from "@astryxdesign/core/EmptyState";
export { HStack } from "@astryxdesign/core/HStack";
export { Icon } from "@astryxdesign/core/Icon";
export { Item } from "@astryxdesign/core/Item";
export { List, ListItem } from "@astryxdesign/core/List";
export { NavIcon } from "@astryxdesign/core/NavIcon";
export { PowerSearch } from "@astryxdesign/core/PowerSearch";
export type {
  PowerSearchConfig,
  PowerSearchFilter,
} from "@astryxdesign/core/PowerSearch";
export { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
export { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
export { Skeleton } from "@astryxdesign/core/Skeleton";
export { Switch } from "@astryxdesign/core/Switch";
export { Text } from "@astryxdesign/core/Text";
export { ToggleButton } from "@astryxdesign/core/ToggleButton";
export { TextArea } from "@astryxdesign/core/TextArea";
export { TextInput } from "@astryxdesign/core/TextInput";
export { Toolbar } from "@astryxdesign/core/Toolbar";
export { createStaticSource } from "@astryxdesign/core/Typeahead";
export { VStack } from "@astryxdesign/core/VStack";
export { defineTheme, Theme } from "@astryxdesign/core/theme";
export type { ThemeMode, TokenName, TokenValue } from "@astryxdesign/core/theme";
