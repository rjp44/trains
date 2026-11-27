// Wide scenes stay in package coordinates. Project a visible copy for the
// existing painter and hit tests, so a tap follows the same pan as a train.
std::vector<Segment> visibleRails;
std::vector<Label> visibleNames;
std::vector<Marker> visibleBerths;
constexpr int scrollLeft=170, scrollWidth=700, scrollY=572;
ViewTables &activeCorridor() { return viewTables[static_cast<unsigned>(currentView())]; }
size_t stationAt(int x) {
    const auto &stops=activeCorridor().stations;
    auto after=std::upper_bound(stops.begin(),stops.end(),x,[](int x,const StationOffset &s){return x<s.x;});
    return after==stops.begin()?0:size_t(after-stops.begin()-1);
}
void panTo(int x) {
    auto &v=activeCorridor();
    int left=v.pan=std::clamp(x,0,v.width-panelWidth), right=left+panelWidth;
    visibleRails.clear();visibleNames.clear();visibleBerths.clear();
    for(auto line:v.lines) if(std::max(line.x1,line.x2)>=left && std::min(line.x1,line.x2)<=right) {
        line.x1-=left;line.x2-=left;visibleRails.push_back(line);
    }
    for(auto label:v.labels) if(label.x+label.width/2>=left && label.x-label.width/2<=right) {
        label.x-=left;visibleNames.push_back(label);
    }
    for(auto marker:v.markers) if(marker.x+32>=left && marker.x-32<=right) {
        marker.x-=left;visibleBerths.push_back(marker);
    }
    Scene *target[]={&sectorScene,&hemelScene,&watfordScene};
    auto &s=*target[static_cast<unsigned>(currentView())];
    s.lines=span(visibleRails);s.labels=span(visibleNames);s.markers=span(visibleBerths);
    invalidate();
}
void drawScrollBar(lv_layer_t *layer) {
    auto &v=activeCorridor();
    text(layer,98,scrollY+9,58,"< Stop",12,Text);
    text(layer,885,scrollY+9,102,"Stop >",12,Text);
    box(layer,scrollLeft,scrollY+7,scrollWidth,4,Edge);
    int thumb=std::max(20,panelWidth*scrollWidth/v.width);
    int offset=v.width==panelWidth?0:v.pan*(scrollWidth-thumb)/(v.width-panelWidth);
    box(layer,scrollLeft+offset,scrollY+2,thumb,14,Rail,-1,5);
}
bool scrollBarTap(int x,int y) {
    if(!directionalLayout() || y<scrollY-4 || x<94) return false;
    auto &v=activeCorridor();
    auto i=stationAt(v.pan+1);
    if(x<scrollLeft) {
        if(v.pan<=v.stations[i].x+3 && i>0) --i;
        panTo(v.stations[i].x);
    } else if(x>scrollLeft+scrollWidth) {
        panTo(i+1<v.stations.size()?v.stations[i+1].x:v.width-panelWidth);
    } else {
        panTo((x-scrollLeft)*v.width/scrollWidth-panelWidth/2);
    }
    return true;
}
