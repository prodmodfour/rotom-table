export const formatLayerVisibilityLabel = (layer: string): string =>
  layer.replace(/([A-Z])/g, ' $1')
