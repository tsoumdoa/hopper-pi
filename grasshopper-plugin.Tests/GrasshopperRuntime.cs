using System;
using System.Reflection;

namespace grasshopper_plugin.Tests
{
    /// <summary>
    /// Tests that execute code touching Grasshopper/Rhino types can only run
    /// where those runtime assemblies are loadable (Windows with Rhino, or a
    /// machine with the managed Rhino SDK). Skip them elsewhere.
    /// </summary>
    public static class GrasshopperRuntime
    {
        public static readonly bool Available = Probe();

        private static bool Probe()
        {
            try
            {
                Assembly.Load("Grasshopper");
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
