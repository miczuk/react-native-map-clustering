import React, { Component } from 'react';
import PropTypes from 'prop-types';
import MapView from 'react-native-maps-osmdroid';
import { UrlTile } from 'react-native-maps-osmdroid';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { width as w, height as h } from 'react-native-dimension';
import SuperCluster from 'supercluster';
import CustomMarker from './CustomMarker';
import deepEqual from 'deep-equal';

export default class MapWithClustering extends Component {
  state = {
    currentRegion: this.props.region,
    userPosition: this.props.userPosition,
    currentChildren: this.props.children,
    clusterStyle: {
      borderRadius: w(6),
      backgroundColor: this.props.clusterColor,
      borderColor: this.props.clusterBorderColor,
      borderWidth: this.props.clusterBorderWidth,
      width: w(14),
      height: w(14),
      justifyContent: 'center',
      alignItems: 'center',
    },
    clusterTextStyle: {
      fontSize: this.props.clusterTextSize,
      color: this.props.clusterTextColor,
      fontWeight: 'bold',
    },
    minZoomLevel: null,
  };

  componentDidMount() {
    this.createMarkersOnMap();
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (nextProps.children != prevState.currentChildren) {
      return {
        currentChildren: nextProps.children
      };
    } else {
      return null
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.children !== prevProps.children) {
      this.createMarkersOnMap(this.state.currentChildren);
    }

    if (this.props.region !== prevProps.region) {
      this.setState({
        currentRegion: this.props.region
      });
    }

    if (this.props.userPosition !== prevProps.userPosition) {
      this.setState({
        userPosition: this.props.userPosition
      });
    }
  }

  onRegionChangeComplete = (region) => {
    const { latitude, latitudeDelta, longitude, longitudeDelta } = this.state.currentRegion;

    const equal = deepEqual({
        latitude: region.latitude,
        longitude: region.longitude,
        longitudeDelta: region.longitudeDelta,
      },
      {
        latitude: latitude,
        longitude: longitude,
        longitudeDelta: longitudeDelta
      });

    if (region.longitudeDelta <= 80 && !equal && shouldClustersBeCalculated(region.longitudeDelta, this.state.currentRegion.longitudeDelta)) {
      if ((Math.abs(region.latitudeDelta - latitudeDelta) > latitudeDelta / 8)
        || (Math.abs(region.longitude - longitude) >= longitudeDelta / 5)
        || (Math.abs(region.latitude - latitude) >= latitudeDelta / 5)) {
        this.calculateClustersForMap(region);
      }
    }

    if(this.props.onRegionChangeComplete && !equal) {
      if(this.state.userPosition) {
        let isUserMarkerVisible = this.checkUserVisibility(region, this.state.userPosition);
        this.props.onRegionChangeComplete(region, isUserMarkerVisible);
      } else {
        this.props.onRegionChangeComplete(region);
      }
    }
  };

  checkUserVisibility(region, userPosition) {
    let bBox = this._calculateBBox(region);
    return (inRange(userPosition.latitude, bBox[1], bBox[3]) && inRange(userPosition.longitude, bBox[0], bBox[2]));
  }

  createMarkersOnMap = () => {
    const markers = [];
    const otherChildren = [];
    let selectedMarker;

    React.Children.forEach(this.props.children, (marker) => {
      if (marker !== null) {
        if (marker.props && marker.props.coordinate && marker.props.cluster !== false) {
          markers.push({
            marker,
            properties: { point_count: 0 },
            geometry: {
              type: 'Point',
              coordinates: [
                marker.props.coordinate.longitude,
                marker.props.coordinate.latitude,
              ],
            },
          });
        } else if (marker.props.selected) {
          selectedMarker = marker;
        } else {
          otherChildren.push(marker);
        }
      }
    });

    if (!this.superCluster) {
      this.superCluster = SuperCluster({
        radius: this.props.radius,
        maxZoom: 9,
        minZoom: 1,
      });
    }
    this.superCluster.load(markers);

    this.setState({
      markers,
      otherChildren,
      selectedMarker,
    }, () => {
      this.calculateClustersForMap();
    });
  };

  calculateBBox = region => [
    region.longitude - region.longitudeDelta, // westLng - min lng
    region.latitude - region.latitudeDelta, // southLat - min lat
    region.longitude + region.longitudeDelta , // eastLng - max lng
    region.latitude + region.latitudeDelta// northLat - max lat
  ];

  _calculateBBox = region => [
    region.longitude - (region.longitudeDelta / 2.1), // westLng - min lng
    region.latitude - (region.latitudeDelta / 2.45), // southLat - min lat
    region.longitude + (region.longitudeDelta / 2.1) , // eastLng - max lng
    region.latitude + (region.latitudeDelta / 2.45)// northLat - max lat
  ];

  getBoundsZoomLevel = (bounds, mapDim) => {
    const WORLD_DIM = { height: mapDim.height, width: mapDim.width };
    const ZOOM_MAX = 20;

    function latRad(lat) {
      const sin = Math.sin(lat * Math.PI / 180);
      const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
      return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
    }

    function zoom(mapPx, worldPx, fraction) {
      return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2);
    }

    function min() {
      var zoomLevels = []
      for (var i = 0; i < arguments.length; i++) {
        if (!isNaN(arguments[i])) {
          zoomLevels.push(arguments[i]);
        }
      }
      return Math.min.apply(Math, zoomLevels);
    }

    const latFraction = (latRad(bounds[3]) - latRad(bounds[1])) / Math.PI;
    const lngDiff = bounds[2] - bounds[0];
    const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;
    const latZoom = zoom(mapDim.height, WORLD_DIM.height, latFraction);
    const lngZoom = zoom(mapDim.width, WORLD_DIM.width, lngFraction);

    return min(latZoom, lngZoom, ZOOM_MAX);
  };

  calculateClustersForMap = async (currentRegion = this.state.currentRegion) => {
    let clusteredMarkers = [];
    if (this.props.clustering && this.superCluster && shouldMarkersBeClustered(currentRegion.longitudeDelta, this.state.currentRegion.longitudeDelta)) {
      const bBox = this.calculateBBox(this.state.currentRegion);
      let zoom = deltaToZoom(currentRegion.longitudeDelta, this.state.currentRegion.longitudeDelta) - 3;
      const clusters = await this.superCluster.getClusters([bBox[0], bBox[1], bBox[2], bBox[3]], zoom);
      const CustomDefinedMarker = this.props.customDefinedMarker || CustomMarker;

      clusteredMarkers = clusters.map(cluster => (<CustomDefinedMarker
        pointCount={cluster.properties.point_count}
        clusterId={cluster.properties.cluster_id}
        geometry={cluster.geometry}
        clusterStyle={this.state.clusterStyle}
        clusterTextStyle={this.state.clusterTextStyle}
        marker={cluster.properties.point_count === 0 ? cluster.marker : null}
        key={JSON.stringify(cluster.geometry) + cluster.properties.cluster_id + cluster.properties.point_count}
        onClusterPress={this.props.onClusterPress}
      />));
    } else {
      clusteredMarkers = this.state.markers.map(marker => marker.marker);
    }

    if (this.state.selectedMarker) {
      clusteredMarkers.push(this.state.selectedMarker);
    }

    this.setState({
      currentRegion,
      clusteredMarkers,
    });
  };

  removeChildrenFromProps = (props) => {
    const newProps = {};
    Object.keys(props).forEach((key) => {
      if (key !== 'children') {
        newProps[key] = props[key];
      }
    });
    return newProps;
  };

  render() {
    return (
      <>
        <MapView
          {...this.removeChildrenFromProps(this.props)}
          ref={(ref) => { this.root = ref; }}
          region={this.state.currentRegion}
          onRegionChangeComplete={this.onRegionChangeComplete}
          minZoomLevel={this.state.minZoomLevel}
          maxZoomLevel={this.props.lockMaxZoomLevel ? 17 : 20}
          onMapReady={() => {
            this.setState({
              minZoomLevel: 2
            })
          }}
          ref={this.props.mapRef}
        >
          <UrlTile
            urlTemplate={"https://tile.geofabrik.de/a2fc98e387ca4d64939c00495b777b46/{z}/{x}/{y}.png"}
            maximumZ={19}
          />
          {this.state.clusteredMarkers}
          {this.state.otherChildren}
        </MapView>
        <View style={styles.licenceBanner}>
          <Text style={styles.licenceBannerText}>Powered by OpenStreetMap</Text>
        </View>
      </>
    );
  }
}

MapWithClustering.propTypes = {
  region: PropTypes.object,
  clustering: PropTypes.bool,
  radius: PropTypes.number,
  clusterColor: PropTypes.string,
  clusterTextColor: PropTypes.string,
  clusterBorderColor: PropTypes.string,
  clusterBorderWidth: PropTypes.number,
  clusterTextSize: PropTypes.number,
  onClusterPress: PropTypes.func,
};

const totalSize = num => (Math.sqrt((h(100) * h(100)) + (w(100) * w(100))) * num) / 100;

const inRange = (val, min, max) => ((val - min) * (val - max) < 0);

const deltaToZoom = delta => Math.round(Math.log(360 / delta) / Math.LN2);

const shouldClustersBeCalculated = (delta, previousDelta) => {
  const minZoom = 1;

  let currentZoom = deltaToZoom(delta);
  let previousZoom = deltaToZoom(previousDelta);

  let calculateClusters = currentZoom <= minZoom ?
    true : previousZoom == currentZoom ?
      false : true;

  return calculateClusters;
}

const shouldMarkersBeClustered = delta => {
  const maxZoom = Platform.OS === 'android' ? 16 : 17;
  let currentZoom = deltaToZoom(delta);

  let clusterMarkers = currentZoom >= maxZoom ? false : true;

  return clusterMarkers;
}

MapWithClustering.defaultProps = {
  clustering: true,
  radius: w(6),
  clusterColor: '#F5F5F5',
  clusterTextColor: '#FF5252',
  clusterBorderColor: '#FF5252',
  clusterBorderWidth: 1,
  clusterTextSize: totalSize(2.4),
  onClusterPress: () => {},
};

const styles = StyleSheet.create({
  licenceBanner: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    paddingTop: 2,
    paddingBottom: 2,
    paddingLeft: 5,
    paddingRight: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  licenceBannerText: {
    fontSize: 8,
    color: '#000',
    opacity: 1.0,
  }
});