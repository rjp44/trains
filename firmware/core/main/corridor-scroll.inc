// Wide scenes stay in package coordinates. Project a visible copy for the
// existing painter and hit tests, so a tap follows the same pan as a train.
std::vector<Segment> visibleRails;
std::vector<Label> visibleNames;
std::vector<Marker> visibleBerths;
constexpr int scrollLeft=170, scrollWidth=700, scrollY=572;
ViewTables &activeCorridor() { return viewTables[static_cast<unsigned>(currentView())]; }
#include "rail-camera.inc"
size_t stationAt(int x) {
    const auto &stops=activeCorridor().stations;
    auto after=std::upper_bound(stops.begin(),stops.end(),x,[](int x,const StationOffset &s){return x<s.x;});
    return after==stops.begin()?0:size_t(after-stops.begin()-1);
}
void panTo(int x, bool reproject=false) {
    static const ViewTables *projectedView=nullptr;
    auto &v=activeCorridor();
    int left=std::clamp(x,0,std::max(0,v.drawnWidth()-v.viewportWidth()));
    if(!reproject && projectedView==&v && left==v.pan) return;
    projectedView=&v;
    v.pan=left;
    auto pixel=[&](int x){return v.projected(x)+v.legendWidth-left;};
    backgroundDirty=true;
    visibleRails.clear();visibleNames.clear();visibleBerths.clear();
    for(auto line:v.lines){
        int a=pixel(line.x1),b=pixel(line.x2);
        if(v.camera && platformBar(line)){
            a=pixel((line.x1+line.x2)/2)-(line.x2-line.x1)/2; b=a+(line.x2-line.x1);
        }
        if(std::max(a,b)<v.legendWidth || std::min(a,b)>panelWidth) continue;
        // Clip long rails before narrowing to the native 16-bit coordinates.
        if(b>a){
            int start=std::max(a,v.legendWidth-2), end=std::min(b,panelWidth+2);
            float slope=float(line.y2-line.y1)/(b-a);
            line.y2=std::lround(line.y1+(end-a)*slope);
            line.y1=std::lround(line.y1+(start-a)*slope);a=start;b=end;
        }
        line.x1=a;line.x2=b;visibleRails.push_back(line);
    }
    for(size_t i=0;i<v.labels.size();++i){
        auto l=v.labels[i];int at=pixel(l.x);
        if(v.camera) {l.y=v.labelY[i]; at+=v.labelShift[i];}
        if(l.y<0 || at+l.width/2<v.legendWidth || at-l.width/2>panelWidth) continue;
        l.x=at;visibleNames.push_back(l);
    }
    for(size_t i=0;i<v.markers.size();++i){
        auto m=v.markers[i];int at=pixel(m.x);
        if(v.camera) m.signalOffset=v.signalOffsets[i];
        if(at+std::max(34,int(m.signalOffset)+10)<v.legendWidth || at-34>panelWidth) continue;
        m.x=at;visibleBerths.push_back(m);
    }
    Scene *target[]={&sectorScene,&hemelScene,&watfordScene};
    auto &s=*target[static_cast<unsigned>(currentView())];
    s.lines=span(visibleRails);s.labels=span(visibleNames);s.markers=span(visibleBerths);
    invalidate();
}
void enterCamera() {
    auto &v=activeCorridor();
    bool initial=!v.axis.ready();
    float anchor=initial?v.focus:v.axis.unproject(v.pan+v.viewportWidth()/2);
    if(initial) buildCamera(v);
    v.axis.setZoom(v.request);
    arrangeHeaders(v);
    panTo(std::lround(v.axis.project(anchor))-v.viewportWidth()/2,true);
}
void drawCorridorLegend(lv_layer_t *layer) {
    const auto &v=activeCorridor();
    if (!v.legendWidth) return;
    int bottom=directionalLayout()?scrollY:panelHeight;
    box(layer,0,transport::toolbarHeight,v.legendWidth,bottom-transport::toolbarHeight,Board);
    auto left=v.axis.unproject(v.pan);
    for (const auto &label : v.legend)
        if (label.from<=left && left<label.to)
            text(layer,3,label.y,v.legendWidth-6,label.name,12,Text);
    if(v.camera && !directionalLayout()) {
        text(layer,3,542,v.legendWidth-6,"< London Euston",10,Muted);
        text(layer,3,557,v.legendWidth-6,"Milton Keynes >",10,Muted);
    }
}
void drawScrollBar(lv_layer_t *layer) {
    auto &v=activeCorridor();
    text(layer,98,scrollY+9,58,"< Stop",12,Text);
    text(layer,885,scrollY+9,102,"Stop >",12,Text);
    box(layer,scrollLeft,scrollY+7,scrollWidth,4,Edge);
    int thumb=std::max(20,v.viewportWidth()*scrollWidth/v.drawnWidth());
    int offset=v.drawnWidth()==v.viewportWidth()?0:v.pan*(scrollWidth-thumb)/(v.drawnWidth()-v.viewportWidth());
    box(layer,scrollLeft+offset,scrollY+2,thumb,14,Rail,-1,5);
}
bool scrollBarTap(int x,int y) {
    if(!directionalLayout() || y<scrollY-4 || x<94) return false;
    auto &v=activeCorridor();
    auto i=stationAt(v.axis.unproject(v.pan+v.viewportWidth()/2));
    if(x<scrollLeft) {
        if(v.pan+v.viewportWidth()/2<=v.projected(stationCentre(v,v.stations[i]))+3 && i>0) --i;
        panTo(v.projected(stationCentre(v,v.stations[i]))-v.viewportWidth()/2);
    } else if(x>scrollLeft+scrollWidth) {
        if(v.pan+v.viewportWidth()/2>=v.projected(stationCentre(v,v.stations[i]))-3 && i+1<v.stations.size()) ++i;
        panTo(v.projected(stationCentre(v,v.stations[i]))-v.viewportWidth()/2);
    } else {
        panTo((x-scrollLeft)*v.drawnWidth()/scrollWidth-v.viewportWidth()/2);
    }
    return true;
}
