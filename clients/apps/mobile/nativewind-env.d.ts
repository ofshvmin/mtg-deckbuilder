/// <reference types="nativewind/types" />

// Why this file re-declares NativeWind's `className` augmentation locally:
//
// NativeWind ships its `className` type augmentation inside react-native-css-interop
// as `declare module "react-native" { ... }`. In this npm-workspace install there are
// two copies of react-native — one under apps/mobile, one under nativewind/node_modules
// — so that augmentation merges into the *other* copy, and `tsc` never sees `className`
// on the react-native components this app actually imports (166 spurious errors).
// Runtime is unaffected: Metro's Babel plugin rewrites `className` regardless of types.
//
// Re-declaring the augmentation here — from a file inside the app — makes "react-native"
// resolve to the app's own copy, so it merges correctly and type-checking works.
// Mirrors react-native-css-interop@0.2.6's dist/types.d.ts; keep in sync if it bumps.
import type {
  ScrollViewProps,
  ScrollViewPropsAndroid,
  ScrollViewPropsIOS,
  Touchable,
  VirtualizedListProps,
} from "react-native";

declare module "@react-native/virtualized-lists" {
  export interface VirtualizedListWithoutRenderItemProps<ItemT>
    extends ScrollViewProps {
    ListFooterComponentClassName?: string;
    ListHeaderComponentClassName?: string;
  }
}

declare module "react-native" {
  interface ScrollViewProps
    extends ViewProps,
      ScrollViewPropsIOS,
      ScrollViewPropsAndroid,
      Touchable {
    contentContainerClassName?: string;
    indicatorClassName?: string;
  }
  interface FlatListProps<ItemT> extends VirtualizedListProps<ItemT> {
    columnWrapperClassName?: string;
  }
  interface ImageBackgroundProps extends ImagePropsBase {
    imageClassName?: string;
  }
  interface ImagePropsBase {
    className?: string;
    cssInterop?: boolean;
  }
  interface ViewProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface TextInputProps {
    placeholderClassName?: string;
  }
  interface TextProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface SwitchProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface InputAccessoryViewProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface TouchableWithoutFeedbackProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface StatusBarProps {
    className?: string;
    cssInterop?: boolean;
  }
  interface KeyboardAvoidingViewProps extends ViewProps {
    contentContainerClassName?: string;
  }
  interface ModalBaseProps {
    presentationClassName?: string;
  }
}
