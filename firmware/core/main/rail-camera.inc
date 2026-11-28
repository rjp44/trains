// All spans use package x coordinates. Trains, fonts and lamp diameters stay
// in physical pixels while the unlocked portions of track change length.
bool platformBar(const Segment &s) {
    return s.ink==Platform && s.y1==s.y2 && s.x2>s.x1;
}
bool rebuildCamera(ViewTables &v) {
    if (!v.camera) return false;
    bool changed=!v.axis.ready();
    v.occupied.resize(v.markers.size());
    for(size_t i=0;i<v.markers.size();++i){
        bool occupied=passengerMapDescription(current[v.markers[i].id]);
        if(v.occupied[i]!=occupied){v.occupied[i]=occupied; changed=true;}
    }
    if(!changed) return false;
    std::vector<rail::Gap> gaps;
    std::vector<rail::Footprint> boxes;
    auto gap=[&](int x,int z,int distance){if(x<z) gaps.push_back({x,z,distance});};
    for(const auto &s:v.lines){
        if(platformBar(s)){
            int middle=(s.x1+s.x2)/2;
            gap(s.x1,middle,middle-s.x1);gap(middle,s.x2,s.x2-middle);
        } else gap(s.x1,s.x2,std::min(s.x2-s.x1,14+int(std::abs(s.y2-s.y1)*0.32f)));
    }
    std::vector<bool> header(v.labels.size());
    for(const auto &h:v.headers) header[h.label]=true;
    for(size_t i=0;i<v.labels.size();++i){
        auto &l=v.labels[i];
        int w=textWidth(l.text,font(l.font))+(l.background>=0?16:2);
        l.width=std::clamp(w,2,1024);
        if(!header[i]){
            int r=(l.width+1)/2, h=(font(l.font)->line_height+2)/2;
            boxes.push_back({l.x,-r,r,l.y-h,l.y+h+1});
        }
    }
    const int bw=(scene->badgeWidth+1)/2+2, bh=(scene->badgeHeight+1)/2+2;
    for(size_t i=0;i<v.markers.size();++i) if(v.occupied[i]){
        const auto &m=v.markers[i];
        boxes.push_back({m.x,-bw,bw,m.y-bh,m.y+bh+1});
        for(const auto &s:v.lines)
            if((s.ink==Rail || s.ink==DC || s.ink==Abbey || s.ink==Bay) &&
                s.y1==m.y && s.y2==m.y && s.x1<=m.x && m.x<=s.x2){
                gap(s.x1,m.x,bw+3);gap(m.x,s.x2,bw+3);break;
            }
    }
    v.signalOffsets.assign(v.markers.size(),0);
    for(size_t i=0;i<v.markers.size();++i){
        const auto &m=v.markers[i];if(!m.radius) continue;
        int r=std::max(9,int(m.radius)+3), top=m.signalY-r,bottom=m.signalY+r+1,dx=0;
        for(const auto &b:boxes) if(b.x==m.x && b.top<bottom && top<b.bottom &&
            b.left<dx+r+4 && b.right>dx-r-4) dx=std::max(dx,b.right+r+4);
        v.signalOffsets[i]=dx; boxes.push_back({m.x,dx-r,dx+r,top,bottom});
    }
    std::vector<Header> signs;
    for(auto h:v.headers) if(!h.optional) signs.push_back(h);
    std::sort(signs.begin(),signs.end(),[&](auto a,auto b){return v.labels[a.label].x<v.labels[b.label].x;});
    for(size_t i=0;i<signs.size();++i){
        const auto &h=signs[i];const auto &l=v.labels[h.label];int r=(l.width+1)/2;
        gap(0,l.x,r+5);gap(l.x,v.width,r+5);
        int previous=0;
        for(size_t j=i;j>0;){
            auto &other=signs[--j]; if(other.primary!=h.primary) continue;
            const auto &a=v.labels[other.label];
            if(++previous==2){gap(a.x,l.x,(a.width+1)/2+r+6);break;}
        }
        // Hemel places its main, DC and Abbey signs beside their own tracks.
        // Leave both candidate rows clear of fixed platform labels and signals.
        int height=(font(l.font)->line_height+2)/2;
        for(const auto &b:boxes) if((h.primary+height>=b.top && h.primary-height<b.bottom) ||
                                    (h.secondary+height>=b.top && h.secondary-height<b.bottom)){
            if(b.x<l.x) gap(b.x,l.x,b.right+r+5);
            else gap(l.x,b.x,r-b.left+5);
        }
    }
    for(size_t i=1;i<v.stations.size();++i)
        gap(stationCentre(v,v.stations[i-1]),stationCentre(v,v.stations[i]),44);
    v.axis.build(v.width,v.viewportWidth(),boxes,gaps);
    v.axis.setZoom(v.request);
    return true;
}

// Colour the intervals in left-edge order. Only a sign that cannot use its
// first row moves. Optional names succeed or disappear for the entire view.
void arrangeHeaders(ViewTables &v) {
    struct Sign { const Header *header; int left,right; };
    std::vector<Sign> signs;
    v.labelY.resize(v.labels.size());
    for(size_t i=0;i<v.labels.size();++i) v.labelY[i]=v.labels[i].y;
    for(const auto &h:v.headers){
        auto &l=v.labels[h.label];int x=v.projected(l.x);
        signs.push_back({&h,x-l.width/2,x+(l.width+1)/2});
    }
    std::sort(signs.begin(),signs.end(),[](auto &a,auto &b){return a.left<b.left;});
    auto pack=[&](bool optional){
        std::vector<std::pair<int,int>> ends;
        for(auto &s:signs){
            auto &h=*s.header;auto &y=v.labelY[h.label];y=-1;
            if(h.optional && !optional) continue;
            if(s.left<3 || s.right>v.drawnWidth()-3) return false;
            for(int row:{h.primary,h.secondary}){
                auto it=std::find_if(ends.begin(),ends.end(),[&](auto p){return p.first==row;});
                if(it!=ends.end() && s.left<it->second+4) continue;
                if(it==ends.end()) ends.emplace_back(row,s.right);
                else it->second=s.right;
                y=row;break;
            }
            if(y<0) return false;
        }
        return true;
    };
    if(!pack(true)) pack(false);
}
