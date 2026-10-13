"""Run in UnrealEditor-Cmd -run=pythonscript -script=<this file> -unattended -nullrhi.
Place physics-asset.json beside the script. Loads original ALS 4.15 content mounted at /ALS.
No asset saves, play session, viewport, or system configuration changes.
"""
import json
import hashlib
import re
from pathlib import Path
import unreal

HERE = Path(__file__).resolve().parent
oracle = json.loads((HERE / 'physics-asset.json').read_text())

def vector(v):
    return {'X': v.x, 'Y': v.y, 'Z': v.z}

def encode(v):
    if v is None or isinstance(v, (str, bool, int, float)):
        return v
    if isinstance(v, unreal.Vector):
        return vector(v)
    if isinstance(v, unreal.Quat):
        return {**vector(v), 'W': v.w}
    if isinstance(v, unreal.Rotator):
        return {'Pitch': v.pitch, 'Yaw': v.yaw, 'Roll': v.roll}
    if isinstance(v, unreal.Transform):
        return {'Translation': vector(v.translation), 'Rotation': encode(v.rotation), 'Scale3D': vector(v.scale3d)}
    if isinstance(v, unreal.Name):
        return str(v)
    if isinstance(v, (tuple, list, unreal.Array)):
        return [encode(x) for x in v]
    if isinstance(v, unreal.EnumBase):
        return v.name
    raise TypeError(type(v).__name__)

# ExportText contains fully initialized native defaults, unlike the sparse uasset tags.
# This grammar is restricted to the numeric/enum/vector/nested-struct constraint schema.
def parse_struct(text):
    parts = re.findall(r'"(?:[^"\\]|\\.)*"|[(),=]|[^(),=]+', text)
    cursor = 0
    def value():
        nonlocal cursor
        t = parts[cursor].strip(); cursor += 1
        if t == '(':
            result = {}
            while parts[cursor] != ')':
                name = parts[cursor].strip(); cursor += 1
                assert parts[cursor] == '='; cursor += 1
                result[name] = value()
                if parts[cursor] == ',': cursor += 1
            cursor += 1
            return result
        if t.startswith('"'): return json.loads(t)
        if t in ('True','False'): return t == 'True'
        try: return float(t)
        except ValueError: return t
    result = value()
    assert cursor == len(parts)
    return result


asset = unreal.load_asset('/ALS/ALS/Character/PA_Als')
mesh = unreal.load_asset('/ALS/ALS/Character/SKM_Als')
assert asset and mesh
actor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(unreal.SkeletalMeshActor, unreal.Vector())
component = actor.skeletal_mesh_component
component.set_skeletal_mesh_asset(mesh)
component.set_physics_asset(asset, True)
component.set_collision_enabled(unreal.CollisionEnabled.QUERY_AND_PHYSICS)
component.set_simulate_physics(True)
component.set_all_bodies_simulate_physics(True)
material = unreal.load_object(None, '/Engine/EngineMaterials/DefaultPhysicalMaterial.DefaultPhysicalMaterial')
report = {
    'schemaVersion': 1,
    'engineVersion': unreal.SystemLibrary.get_engine_version(),
    'alsTag': '4.15',
    'alsCommit': 'b3cbf4305358606746f47778f1c2753cd8e3a35a',
    'assetUassetSha256': hashlib.sha256((HERE / 'Plugins/ALS/Content/ALS/Character/PA_Als.uasset').read_bytes()).hexdigest(),
    'assetCanonicalSha256': oracle['canonicalSha256'],
    'units': {'mass': 'kg', 'length': 'cm', 'inertia': 'kg cm^2', 'angularVelocity': 'radians/s'},
    'defaultPhysicalMaterial': {n: material.get_editor_property(n) for n in ['density','raise_mass_to_power','friction','restitution']},
    'constraintInstanceDefaults': parse_struct(unreal.ConstraintInstance().export_text()),
    'bodies': [], 'constraints': [],
    'collisionDisablePairs': oracle['collisionDisablePairs'],
}
for body in oracle['bodies']:
    name = body['boneName']
    setup = unreal.find_object(asset, body['exportName'])
    instance = setup.get_editor_property('default_instance')
    transform = component.get_socket_transform(name, unreal.RelativeTransformSpace.RTS_WORLD)
    mass = component.get_bone_mass(name)
    assert mass > 0, name
    report['bodies'].append({
        'boneName': name, 'massKg': mass, 'massScale': component.get_mass_scale(name),
        'physicsType': encode(setup.get_editor_property('physics_type')),
        'inertiaKgCm2': vector(component.get_inertia_tensor(name)),
        'massSpaceLocal': encode(unreal.AlsPhysicsExportLibrary.get_body_mass_space(component, name)),
        'isSimulatingPhysicsForProbe': component.is_simulating_physics(name),
        'centerOfMassWorldCm': vector(component.get_center_of_mass(name)),
        'boneWorldTransform': encode(transform),
        'defaultInstance': {n: encode(instance.get_editor_property(n)) for n in [
            'mass_scale','linear_damping','angular_damping','inertia_tensor_scale','use_ccd',
            'enable_gravity','inertia_conditioning','position_solver_iteration_count',
            'velocity_solver_iteration_count','projection_solver_iteration_count',
        ]},
        'defaultInstanceText': instance.export_text(),
    })
library = unreal.ConstraintInstanceBlueprintLibrary
getters = [n for n in dir(library) if n.startswith('get_') and n not in dir(unreal.BlueprintFunctionLibrary)]
for constraint in oracle['constraints']:
    resolved = json.loads(unreal.AlsPhysicsExportLibrary.get_constraint_instance_text(asset, constraint['index']))
    assert resolved['JointName'] == constraint['jointName']
    accessor = asset.get_constraint_by_name(constraint['jointName'])
    getters_data = {}
    for name in getters:
        result = getattr(library, name)(accessor)
        # Some UE getter bool outputs lack UPARAM(ref) and are not exposed to Python.
        if isinstance(result, tuple): getters_data[name] = encode(result[1:])
        else: getters_data[name] = {'unavailable': 'Python wrapper has no return output'}
    limits = getters_data['get_angular_limits']
    p = resolved['ProfileInstance']
    assert limits[1] == p['ConeLimit']['Swing1LimitDegrees']
    assert limits[3] == p['ConeLimit']['Swing2LimitDegrees']
    assert limits[5] == p['TwistLimit']['TwistLimitDegrees']
    report['constraints'].append({'jointName':constraint['jointName'], 'resolvedInstance':resolved, 'liveAssetGetters':getters_data})
report['validations'] = {'bodyCount':len(report['bodies']), 'constraintCount':len(report['constraints']),
                         'liveLimitsMatchResolvedInstances':True}
(HERE / 'physics-asset-runtime.json').write_text(json.dumps(report, indent=2) + '\n', newline='\n')
unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(actor)
unreal.log('ALS_PHYSICS_RUNTIME_EXPORT_COMPLETE')
