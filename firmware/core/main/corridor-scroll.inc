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
    int left=v.pan=std::clamp(x,0,v.width-v.viewportWidth()), right=left+v.viewportWidth();
    int offset=v.legendWidth-left;
    visibleRails.clear();visibleNames.clear();visibleBerths.clear();
    for(auto line:v.lines) if(std::max(line.x1,line.x2)>=left && std::min(line.x1,line.x2)<=right) {
        line.x1+=offset;line.x2+=offset;visibleRails.push_back(line);
    }
    for(auto label:v.labels) if(label.x+label.width/2>=left && label.x-label.width/2<=right) {
        label.x+=offset;visibleNames.push_back(label);
    }
    for(auto marker:v.markers) if(marker.x+32>=left && marker.x-32<=right) {
        marker.x+=offset;visibleBerths.push_back(marker);
    }
    Scene *target[]={&sectorScene,&hemelScene,&watfordScene};
    auto &s=*target[static_cast<unsigned>(currentView())];
    s.lines=span(visibleRails);s.labels=span(visibleNames);s.markers=span(visibleBerths);
    invalidate();
}
void drawCorridorLegend(lv_layer_t *layer) {
    const auto &v=activeCorridor();
    if (!v.legendWidth) return;
    box(layer,0,transport::toolbarHeight,v.legendWidth,scrollY-transport::toolbarHeight,Board);
    for (const auto &label : v.legend)
        if (label.from<=v.pan && v.pan<label.to)
            text(layer,3,label.y,v.legendWidth-6,label.name,12,Text);
}
void drawScrollBar(lv_layer_t *layer) {
    auto &v=activeCorridor();
    text(layer,98,scrollY+9,58,"< Stop",12,Text);
    text(layer,885,scrollY+9,102,"Stop >",12,Text);
    box(layer,scrollLeft,scrollY+7,scrollWidth,4,Edge);
    int thumb=std::max(20,v.viewportWidth()*scrollWidth/v.width);
    int offset=v.width==v.viewportWidth()?0:v.pan*(scrollWidth-thumb)/(v.width-v.viewportWidth());
    box(layer,scrollLeft+offset,scrollY+2,thumb,14,Rail,-1,5);
}
bool scrollBarTap(int x,int y) {
    if(!directionalLayout() || y<scrollY-4 || x<94) return false;
    auto &v=activeCorridor();
    auto i=stationAt(v.pan+v.viewportWidth()/2);
    if(x<scrollLeft) {
        if(v.pan+v.viewportWidth()/2<=stationCentre(v,v.stations[i])+3 && i>0) --i;
        panTo(stationCentre(v,v.stations[i])-v.viewportWidth()/2);
    } else if(x>scrollLeft+scrollWidth) {
        if(v.pan+v.viewportWidth()/2>=stationCentre(v,v.stations[i])-3 && i+1<v.stations.size()) ++i;
        panTo(stationCentre(v,v.stations[i])-v.viewportWidth()/2);
    } else {
        panTo((x-scrollLeft)*v.width/scrollWidth-v.viewportWidth()/2);
    }
    return true;
}
