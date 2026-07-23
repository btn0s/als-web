using System.Reflection;

public static class ReflectProbe
{
    public static int Run(string[] names)
    {
        var assembly = typeof(CUE4Parse.UE4.Assets.Exports.UObject).Assembly;
        foreach (var query in names)
        {
            var matches = assembly.GetTypes()
                .Where(type => type.FullName?.Contains(query, StringComparison.OrdinalIgnoreCase) == true)
                .OrderBy(type => type.FullName);
            foreach (var type in matches)
            {
                Console.WriteLine($"\nTYPE {type.FullName} : {type.BaseType?.FullName}");
                foreach (var constructor in type.GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
                    Console.WriteLine($"  CTOR {constructor}");
                foreach (var field in type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                    Console.WriteLine($"  FIELD {field.FieldType.FullName} {field.Name}");
                foreach (var property in type.GetProperties(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                    Console.WriteLine($"  PROP {property.PropertyType.FullName} {property.Name}");
                foreach (var method in type.GetMethods(BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                             .Where(method => method.Name is "Deserialize" or "RegisterClass" or "Read" or "Get"))
                    Console.WriteLine($"  METHOD {method}");
            }
        }
        return 0;
    }
}
