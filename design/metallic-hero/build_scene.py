"""Original Swordfish brand sculpture. Run with Blender --background --python.
Creates an editable scene and a studio-lit, seamless eight-second assembly loop.
No external models, textures, or reference-company artwork are used.
"""
import bpy, math, sys, os
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = Path('/tmp/swordfish-metallic')
OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
s = bpy.context.scene
s.render.engine = 'BLENDER_EEVEE'
s.eevee.taa_render_samples = 64
s.eevee.use_raytracing = True
s.eevee.ray_tracing_options.resolution_scale = '2'
s.eevee.ray_tracing_options.screen_trace_quality = .8
s.render.resolution_x = 1536
s.render.resolution_y = 960
s.render.resolution_percentage = 100
s.render.fps = 24
s.frame_start = 1
s.frame_end = 192
s.render.image_settings.file_format = 'PNG'
s.render.image_settings.color_mode = 'RGB'
s.render.image_settings.compression = 15
s.render.film_transparent = False
s.view_settings.view_transform = 'AgX'
s.view_settings.look = 'AgX - Medium High Contrast'
s.view_settings.exposure = -.3
s.render.use_file_extension = True

# A blue horizon and broad softboxes give titanium readable black/white reflections.
world = bpy.data.worlds.new('Midnight studio')
s.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.055, .08, .14, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .32


def mat(name, color, metallic=1, rough=.22, brushed=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Anisotropic'].default_value = .35 if brushed else .1
    if brushed:
        nodes = m.node_tree.nodes; links = m.node_tree.links
        tex = nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = 180
        tex.inputs['Detail'].default_value = 2
        coords = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
        mapping.inputs[1].default_value = (1, 32, 1)
        links.new(coords.outputs['Generated'], mapping.inputs[0]); links.new(mapping.outputs[0],tex.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.12; bump.inputs['Distance'].default_value=.006
        links.new(tex.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs[0],bs.inputs['Normal'])
    return m


def luminous(name, color, strength):
    m=mat(name,color,0,.25)
    p=m.node_tree.nodes['Principled BSDF']
    p.inputs['Emission Color'].default_value=(*color,1)
    p.inputs['Emission Strength'].default_value=strength
    return m

titanium=mat('Satin titanium / directional micrograin',(.3,.35,.43),1,.24,True)
chrome=mat('Polished chamfer',(.72,.79,.88),1,.13)
black=mat('Anodized graphite',(.035,.047,.07),1,.25)
steel=mat('Machined underside',(.25,.31,.4),1,.29,True)
blue=luminous('Swordfish signal / cobalt',(.012,.16,1),3.5)
white=mat('Laser etched lettering',(.62,.7,.82),.65,.4)

bpy.ops.object.empty_add(type='PLAIN_AXES')
rig=bpy.context.object; rig.name='Swordfish / assembly rig'
parts=[]


def parent(obj, p):
    if p: obj.parent=p
    return obj


def bevel(obj, width=.065, segments=4):
    mod=obj.modifiers.new('Precision machined edges','BEVEL'); mod.width=width; mod.segments=segments
    mod.affect='EDGES'
    mod.profile=.5
    mod=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL'); mod.keep_sharp=True; mod.weight=50
    for face in obj.data.polygons: face.use_smooth=True


def plate(name, polygon, depth, z, material, p=rig, width=.06, lift=None):
    # Triangulate the concave Swordfish mark so its notches stay true to the logo.
    vs=[Vector((x,y,0)) for x,y in polygon]
    triangles=tessellate_polygon([vs])
    verts=[(v.x,v.y,-depth/2) for v in vs]+[(v.x,v.y,depth/2+(lift[i] if lift else 0)) for i,v in enumerate(vs)]
    n=len(vs)
    def index(v): return v if isinstance(v,int) else min(range(n),key=lambda i:(vs[i]-v).length_squared)
    faces=[]
    for tri in triangles:
        ids=[index(v) for v in tri]
        faces.append(tuple(reversed(ids))); faces.append(tuple(i+n for i in ids))
    for i in range(n): faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); s.collection.objects.link(obj)
    obj.location.z=z; obj.data.materials.append(material)
    parent(obj,p); bevel(obj,width,5)
    return obj


def cylinder(name, radius, depth, location, material, p=rig, vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=location)
    obj=bpy.context.object; obj.name=name; obj.data.materials.append(material); parent(obj,p); bevel(obj,.025,3)
    return obj


def torus(name, radius, tube, z, material, p=rig):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=tube,major_segments=128,minor_segments=16,location=(0,0,z))
    obj=bpy.context.object; obj.name=name; obj.data.materials.append(material); parent(obj,p)
    for f in obj.data.polygons: f.use_smooth=True
    return obj


def line(name, coordinates, radius, material, p=rig):
    curve=bpy.data.curves.new(name,'CURVE'); curve.dimensions='3D'; curve.bevel_depth=radius; curve.bevel_resolution=3
    spline=curve.splines.new('POLY'); spline.points.add(len(coordinates)-1)
    for point,co in zip(spline.points,coordinates): point.co=(*co,1)
    obj=bpy.data.objects.new(name,curve); s.collection.objects.link(obj); obj.data.materials.append(material); parent(obj,p)
    return obj

# Exact silhouette from the existing SVG brand mark, in a machined multilayer body.
shape=[((x-18)*.23,(16-y)*.23) for x,y in [(3,29),(14,16),(8,13),(34,3),(21,23),(20,14)]]
main=plate('01 / Swordfish titanium face',shape,.3,.52,titanium,lift=[0,.18,0,0,0,.5])
parts.append((main,Vector((.12,.14,1.9)),Vector((.03,-.1,.07))))
seam=plate('02 / blue signal channel',[(x*.985,y*.985) for x,y in shape],.045,.305,black,width=.018)
seam.data.materials.append(blue)
for face in seam.data.polygons:
    if abs(face.normal.z)<.5: face.material_index=1
parts.append((seam,Vector((.03,.07,1.2)),Vector((0,-.04,.035))))
mid=plate('03 / dark strategy layer',[(x*.97,y*.97) for x,y in shape],.24,.13,black)
parts.append((mid,Vector((-.05,-.04,.45)),Vector((-.02,.05,-.03))))
base=plate('04 / polished lower shell',[(x*.99,y*.99) for x,y in shape],.2,-.11,chrome)
parts.append((base,Vector((-.1,-.15,-.5)),Vector((.01,.08,-.06))))

# Segmented circular substrate: an engineered object with depth and open negative space.
bpy.ops.object.empty_add(type='PLAIN_AXES',location=(0,0,-.85))
engine=bpy.context.object; engine.name='05 / infrastructure substrate'; parent(engine,rig)
parts.append((engine,Vector((-.18,-.2,-1.6)),Vector((.06,.08,-.22))))
for r,t,z,m in [(2.12,.16,0,steel),(2.32,.055,0,chrome),(1.9,.045,.03,chrome),(2.12,.026,.18,blue),(2.12,.14,-.3,black),(2.32,.035,-.3,chrome)]:
    torus('Concentric precision ring',r,t,z,m,engine)
# Discrete radial modules, fine fastening points and a central processor.
for i in range(12):
    a=i*math.tau/12
    x,y=math.cos(a)*2.12,math.sin(a)*2.12
    bolt=cylinder('Captive hex fastener %02d'%i,.087,.1,(x,y,.2),chrome,engine,6)
    cylinder('Recess %02d'%i,.032,.006,(x,y,.253),black,engine,12)
    if i%2==0:
        r0,r1=.65,1.9
        line('Signal conductor',[(math.cos(a)*r0,math.sin(a)*r0,-.06),(math.cos(a)*1.3,math.sin(a)*1.3,-.06),(math.cos(a+.12)*r1,math.sin(a+.12)*r1,-.06)],.018,blue,engine)
        cylinder('Standoff %02d'%i,.1,.55,(math.cos(a)*1.45,math.sin(a)*1.45,-.25),steel,engine)
chip=plate('Strategy core', [(-.43,-.43),(.43,-.43),(.43,.43),(-.43,.43)],.25,0,black,engine,.06)
torus('Core signal ring',.63,.025,.06,blue,engine)
for i in range(4):
    a=i*math.pi/2
    for j in range(6):
        x=.52; y=(j-2.5)*.12
        p1=(x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a),0)
        p2=((x+.19)*math.cos(a)-y*math.sin(a),(x+.19)*math.sin(a)+y*math.cos(a),0)
        line('Processor contact',[p1,p2],.018,chrome,engine)

# Ground is a dark continuous studio sweep with a pool of cobalt illumination.
ground=mat('Ink studio floor',(.009,.018,.037),.3,.32)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-4.4))
floor=bpy.context.object; floor.name='Infinite studio floor'; floor.data.materials.append(ground)


def area(name,position,target,power,color,size,size_y=None):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color
    data.shape='RECTANGLE'; data.size=size; data.size_y=size_y if size_y else size
    obj=bpy.data.objects.new(name,data); s.collection.objects.link(obj); obj.location=position
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj

area('Key / long white softbox',(-3,-4,10),(0,0,0),1450,(.82,.9,1),8,3)
area('Silver edge / strip',(7,1,6),(0,0,0),2000,(.91,.96,1),7,.8)
area('Cool rim',(-5,5,4),(0,0,0),2400,(.19,.4,1),5,2)
area('Front fill',(0,-8,3),(0,0,0),700,(.5,.66,1),5,4)
area('Blue ground pool',(1,5,1),(0,0,-4.4),1800,(.045,.17,1),7,6)
sweep=area('Moving reflection',(1,3,9),(0,0,0),1300,(1,1,1),5,.4)

bpy.ops.object.camera_add(location=(7,-10,17))
cam=bpy.context.object; cam.name='Camera / studio macro'; s.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=16.5
cam.data.shift_x=-.19
cam.data.lens=55
cam.rotation_euler=(Vector((0,0,-.1))-cam.location).to_track_quat('-Z','Y').to_euler()
# Gentle depth of field retains the main silhouette while pushing the floor away.
cam.data.dof.use_dof=True; cam.data.dof.focus_distance=(cam.location-Vector((0,0,.1))).length; cam.data.dof.aperture_fstop=10

origins=[(o,o.location.copy(),o.rotation_euler.copy(),delta,rot) for o,delta,rot in parts]
# Endpoint velocities are zero and frame 193 matches frame 1 for a seamless loop.
for frame in range(1,194,4):
    t=(frame-1)/192*math.tau
    expansion=(.5-.5*math.cos(t))**1.65
    rig.rotation_euler=(math.radians(-7)+math.sin(t)*.08, math.radians(-14)+math.sin(t)*.16, math.radians(15)+math.sin(t)*.16)
    rig.location=(0,0,.2+math.sin(t)*.1)
    rig.keyframe_insert('rotation_euler',frame=frame); rig.keyframe_insert('location',frame=frame)
    for o,loc,rot,delta,r in origins:
        o.location=loc+delta*expansion
        o.rotation_euler=Vector(rot)+r*expansion
        o.keyframe_insert('location',frame=frame); o.keyframe_insert('rotation_euler',frame=frame)
    sweep.location.x=math.sin(t)*4
    sweep.rotation_euler=(Vector((0,0,0))-sweep.location).to_track_quat('-Z','Y').to_euler()
    sweep.keyframe_insert('location',frame=frame); sweep.keyframe_insert('rotation_euler',frame=frame)
    cam.data.ortho_scale=16.5-math.sin(t/2)**2*.9
    cam.data.keyframe_insert('ortho_scale',frame=frame)

s.frame_set(1)
s.render.filepath=str(OUT/'frames/frame_')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'swordfish-titanium.blend'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if '--preview' in args:
    s.render.resolution_percentage=65
    s.eevee.taa_render_samples=24
    for frame in [1,97]:
        s.frame_set(frame); s.render.filepath=str(OUT/('preview-%03d.png'%frame))
        bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
