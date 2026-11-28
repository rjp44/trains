#pragma once
#include <algorithm>
#include <cmath>
#include <vector>

namespace rail {
struct Gap { int from, to, width; };
struct Footprint { int x, left, right, top, bottom; };

// The ordered constraints use the same two passes as the browser. Solve only
// the infrastructure once per view. A pinch interpolates the cached coordinates.
class Axis {
    std::vector<int> source;
    std::vector<float> tight, spare, placed;
    float minimum = 0, normal = 0;
    template <class A, class B> static float map(float x, const A &a, const B &b) {
        if (x <= a.front()) return b.front();
        if (x >= a.back()) return b.back();
        auto j = std::upper_bound(a.begin(), a.end(), x) - a.begin();
        return b[j-1] + (b[j]-b[j-1]) * (x-a[j-1]) / (a[j]-a[j-1]);
    }
public:
    float zoom = 1, minZoom = 1;
    bool ready() const { return !placed.empty(); }
    float project(float x) const { return ready() ? map(x,source,placed) : x; }
    float unproject(float x) const { return ready() ? map(x,placed,source) : x; }
    int width() const { return std::lround(placed.back()); }
    void build(int width, int viewport, std::vector<Footprint> &boxes, std::vector<Gap> &gaps) {
        std::sort(boxes.begin(), boxes.end(), [](auto &a, auto &b){return a.x < b.x;});
        struct Rim { int x = -1, right = 0; };
        // Last occupied column in each screen row. Coalesce identical edges
        // instead of allocating a graph per scanline on the tablet.
        std::vector<Rim> rows(600);
        std::vector<int> left(600), right(600);
        for (size_t i=0; i<boxes.size();) {
            int x=boxes[i].x, top=600, bottom=0;
            size_t end=i;
            while(end<boxes.size() && boxes[end].x==x) {
                auto &b=boxes[end++];
                top=std::min(top,std::clamp(b.top,0,600)); bottom=std::max(bottom,std::clamp(b.bottom,0,600));
                gaps.push_back({0,x,4-b.left}); gaps.push_back({x,width,4+b.right});
            }
            std::fill(left.begin()+top,left.begin()+std::max(top,bottom),32767);
            std::fill(right.begin()+top,right.begin()+std::max(top,bottom),-32767);
            for (;i<end;++i) for(int y=std::max(0,boxes[i].top);y<std::min(600,boxes[i].bottom);++y) {
                left[y]=std::min(left[y],boxes[i].left); right[y]=std::max(right[y],boxes[i].right);
            }
            for(int y=top;y<bottom;++y) if(left[y]!=32767) {
                auto &p=rows[y];
                if(p.x>=0){
                    int gap=p.right+4-left[y];
                    if(gaps.empty() || gaps.back().from!=p.x || gaps.back().to!=x || gaps.back().width!=gap)
                        gaps.push_back({p.x,x,gap});
                }
                p={x,right[y]};
            }
        }
        source={0,width};
        for(auto g:gaps){source.push_back(g.from);source.push_back(g.to);}
        std::sort(source.begin(),source.end());
        source.erase(std::unique(source.begin(),source.end()),source.end());
        std::sort(gaps.begin(),gaps.end(),[](auto a,auto b){return a.to<b.to;});
        std::vector<Gap> edges;
        for(auto g:gaps) if(g.from<g.to && g.width>0){
            auto idx=[&](int x){return int(std::lower_bound(source.begin(),source.end(),x)-source.begin());};
            edges.push_back({idx(g.from),idx(g.to),g.width});
        }
        const size_t n=source.size();
        std::vector<float> earliest(n),remaining(n);
        size_t edge=0;
        for(size_t j=1;j<n;++j){
            earliest[j]=earliest[j-1]+0.5f;
            while(edge<edges.size() && edges[edge].to==int(j)){
                auto g=edges[edge++]; earliest[j]=std::max(earliest[j],earliest[g.from]+g.width);
            }
        }
        for(size_t j=n-1;j>0;--j){
            remaining[j-1]=std::max(remaining[j-1],remaining[j]+0.5f);
            while(edge && edges[edge-1].to==int(j)){
                auto g=edges[--edge]; remaining[g.from]=std::max(remaining[g.from],remaining[j]+g.width);
            }
        }
        minimum=earliest.back(); normal=std::max(float(width),minimum);
        minZoom=std::max(float(viewport),minimum)/normal;
        tight.resize(n);spare.resize(n);placed.resize(n);
        for(size_t j=0;j<n;++j){
            tight[j]=(earliest[j]+minimum-remaining[j])/2;
            spare[j]=j?spare[j-1]+std::max(0.f,source[j]-source[j-1]-(tight[j]-tight[j-1])):0;
        }
    }
    void setZoom(float request){
        zoom=std::clamp(request,minZoom,3.f);
        float width=normal*zoom, slack=std::min(width,normal)-minimum, extra=std::max(0.f,width-normal);
        for(size_t j=0;j<placed.size();++j)
            placed[j]=tight[j]+(spare.back()>0?slack*spare[j]/spare.back():0)+extra*source[j]/source.back();
    }
};
}
